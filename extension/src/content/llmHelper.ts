/**
 * Helper to handle LLM calls for error diagnostics and status verification.
 * Support Chrome's native window.ai (Gemini Nano) and Gemini API Flash fallback.
 */

export interface LlmConfig {
  useLlm: boolean;
  geminiApiKey?: string;
}

export interface ErrorClassification {
  classification: 'safety' | 'quota' | 'transient' | 'fake_cancel' | 'unknown';
  reason: string;
}

export interface VerificationStatus {
  status: 'done' | 'generating' | 'failed' | 'unknown';
  decision?: 'fake_cancel' | 'reload_needed' | 'failed' | 'done';
  reason: string;
}

/**
 * Load LLM configuration from chrome.storage.local.
 */
export async function getLlmConfig(): Promise<LlmConfig> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['autoflow_settings'], (res) => {
      const settings = res.autoflow_settings || {};
      resolve({
        useLlm: !!settings.llmEnabled,
        geminiApiKey: settings.llmApiKey || '',
      });
    });
  });
}

/**
 * Call the local Chrome AI assistant (Gemini Nano).
 */
async function callLocalChromeAi(prompt: string, systemPrompt?: string): Promise<string> {
  const win = window as any;
  if (!win.ai) {
    throw new Error('Chrome window.ai is not available');
  }

  const aiObj = win.ai.languageModel || win.ai.assistant;
  if (!aiObj) {
    throw new Error('Chrome AI language model / assistant APIs are not defined');
  }

  const session = await aiObj.create({
    systemPrompt: systemPrompt || 'You are a helpful assistant.',
  });

  try {
    const response = await session.prompt(prompt);
    return response.trim();
  } finally {
    session.destroy();
  }
}

/**
 * Call the cloud Gemini API via the background script to bypass CORS and secure keys.
 */
async function callCloudGemini(prompt: string, systemPrompt?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: 'CALL_LLM',
        payload: { prompt, systemPrompt },
      },
      (res) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (res && res.error) {
          reject(new Error(res.error));
        } else if (typeof res === 'string') {
          resolve(res);
        } else if (res && res.text) {
          resolve(res.text);
        } else {
          reject(new Error('Invalid response from background script'));
        }
      }
    );
  });
}

/**
 * General LLM dispatcher with free trial credit protection.
 */
async function queryLlm(prompt: string, systemPrompt: string): Promise<string> {
  const config = await getLlmConfig();
  if (!config.useLlm) {
    throw new Error('LLM diagnostics is disabled in settings');
  }

  // Try local Chrome AI first (100% free and unlimited)
  const win = window as any;
  if (win.ai) {
    try {
      console.log('[AutoFlow LLM] Routing request to local Gemini Nano...');
      return await callLocalChromeAi(prompt, systemPrompt);
    } catch (err: any) {
      console.warn('[AutoFlow LLM] Local Chrome AI failed, attempting fallback:', err.message || err);
    }
  }

  // If user provided their own key, they have unlimited use
  if (config.geminiApiKey) {
    console.log('[AutoFlow LLM] Routing request to user custom Gemini API key...');
    return await callCloudGemini(prompt, systemPrompt);
  }

  // Otherwise, handle 1-time free trial check using the extension default key
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['af_llm_free_credits'], async (res) => {
      let credits = res.af_llm_free_credits;
      // Initialize to 1 if not set
      if (credits === undefined) {
        credits = 1;
      }

      if (credits <= 0) {
        reject(
          new Error(
            'Your free AI trial credit has expired. Please configure your own Gemini API Key in the sidepanel settings to continue!'
          )
        );
        return;
      }

      // Consume the credit
      console.log('[AutoFlow LLM] Consuming 1 free trial credit. Remaining: 0');
      chrome.storage.local.set({ af_llm_free_credits: 0 }, async () => {
        try {
          const result = await callCloudGemini(prompt, systemPrompt);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });
    });
  });
}

/**
 * Classify a generation failure error message.
 */
export async function classifyGenerationError(errorText: string): Promise<ErrorClassification> {
  const systemPrompt = `You are a technical diagnostic agent. Your task is to analyze an error message from a video generation tool and classify it.
You MUST respond with a valid JSON object only. Do NOT wrap your JSON in markdown blocks (no \`\`\`json).
The format MUST be:
{
  "classification": "safety" | "quota" | "transient" | "fake_cancel" | "unknown",
  "reason": "Short explanation of why this classification was selected."
}`;

  const prompt = `Classify this error: "${errorText}"`;

  try {
    const responseText = await queryLlm(prompt, systemPrompt);
    // Strip possible markdown wrapping if local model ignores instructions
    const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(cleanJson);
    if (!result.classification) {
      throw new Error('Invalid response structure: missing classification field');
    }
    return {
      classification: result.classification,
      reason: result.reason || 'Classified by LLM.',
    };
  } catch (err: any) {
    console.error('[AutoFlow LLM] Error classification failed:', err);
    // Safe rule-based fallback
    let fallbackCls: 'safety' | 'quota' | 'transient' | 'fake_cancel' | 'unknown' = 'unknown';
    const lower = errorText.toLowerCase();
    if (lower.includes('safety') || lower.includes('policy')) fallbackCls = 'safety';
    else if (lower.includes('quota') || lower.includes('credit') || lower.includes('limit')) fallbackCls = 'quota';
    else if (lower.includes('network') || lower.includes('connection')) fallbackCls = 'transient';
    else if (lower.includes('cancel')) fallbackCls = 'fake_cancel';

    return {
      classification: fallbackCls,
      reason: `Fallback parser due to error: ${err.message || err}`,
    };
  }
}

/**
 * Verify a grid tile's state based on its label text.
 */
export async function verifyTileStatus(tileText: string): Promise<VerificationStatus> {
  const systemPrompt = `You are a verification agent for a video generation grid. Your task is to determine the state of a tile based on its visible text.
You MUST respond with a valid JSON object only. Do NOT wrap your JSON in markdown blocks (no \`\`\`json).
The format MUST be:
{
  "status": "done" | "generating" | "failed" | "unknown",
  "decision": "fake_cancel" | "reload_needed" | "failed" | "done",
  "reason": "Short explanation of why this state and decision were selected."
}`;

  const prompt = `Determine status for this tile text: "${tileText}"`;

  try {
    const responseText = await queryLlm(prompt, systemPrompt);
    const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(cleanJson);
    if (!result.status) {
      throw new Error('Invalid response structure: missing status field');
    }
    return {
      status: result.status,
      decision: result.decision || (result.status === 'generating' || result.status === 'done' ? 'fake_cancel' : 'failed'),
      reason: result.reason || 'Verified by LLM.',
    };
  } catch (err: any) {
    console.error('[AutoFlow LLM] Tile verification failed:', err);
    // Safe rule-based fallback
    let fallbackStatus: 'done' | 'generating' | 'failed' | 'unknown' = 'unknown';
    const lower = tileText.toLowerCase();
    if (lower.includes('download') || lower.includes('ready') || lower.includes('play')) fallbackStatus = 'done';
    else if (lower.includes('creating') || lower.includes('generating') || lower.includes('working') || lower.includes('%')) fallbackStatus = 'generating';
    else if (lower.includes('failed') || lower.includes('error') || lower.includes('cancelled')) fallbackStatus = 'failed';

    let fallbackDecision: 'fake_cancel' | 'reload_needed' | 'failed' | 'done' = 'failed';
    if (fallbackStatus === 'done') fallbackDecision = 'done';
    else if (fallbackStatus === 'generating') fallbackDecision = 'fake_cancel';

    return {
      status: fallbackStatus,
      decision: fallbackDecision,
      reason: `Fallback parser due to error: ${err.message || err}`,
    };
  }
}
