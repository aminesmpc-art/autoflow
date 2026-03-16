# Live Run Monitor — AutoFlow Tutorial

**Video Type:** Feature Deep-Dive | **Duration:** 2–3 min

---

## 🎬 HOOK (0:00–0:10)

> "Ever started an automation and wondered 'what's it doing right now?' AutoFlow's Run Monitor shows you every single action — live."

---

## 📌 INTRO (0:10–0:30)

> "When you hit Run on a queue, AutoFlow doesn't just disappear into the background. You get a real-time log of everything it does, plus full playback controls. Let's walk through it."

---

## 🖥️ DEMO (0:30–2:00)

### Starting a Run

> "I've got a queue with 4 prompts. I hit Run, and the Run Monitor appears at the bottom of the panel."

**[SCREEN: Click Run → Run Monitor expands with green dot "● Run Monitor"]**

### Live Log

> "The monitor shows a timestamped log of every action:"

```
[16:44:57] Opening view settings via: simulateClick
[16:44:57] Clear prompt on submit: already ON
[16:44:57] Enabled "show tile details"
[16:44:58] All settings applied
[16:44:59] Baseline tiles on page: 2
[16:44:59] Processing prompt #1 (attempt 1/3)
[16:45:00] Prompt filled (4 chars, method=paste)
```

> "You can see exactly what AutoFlow is doing — opening settings, filling prompts, detecting tiles, waiting for generation. Full transparency."

**[SCREEN: Show live log scrolling with timestamps]**

### Playback Controls

> "At the top of the monitor you have five controls:"
>
> - **⏸ Pause** — Freeze the automation mid-task
> - **▶ Resume** — Continue from where you paused
> - **⏹ Stop** — Cancel the entire queue
> - **⏭ Skip** — Skip the current prompt and move to the next one
> - **🔄 Retry** — Retry the current prompt from scratch
>
> "So if a prompt is taking too long, just Skip. If something looks wrong, Pause and check."

**[SCREEN: Highlight each control button]**

### Progress Counter

> "In the top-right corner you see the progress: '0 / 4', '1 / 4', '2 / 4'… all the way to completion."
>
> "When the queue finishes, you get a toast notification: 'Queue AUTOFLOW1 completed.'"

**[SCREEN: Show progress counter → completion toast]**

### Auto-Retry

> "If a video fails to generate, AutoFlow automatically retries it — up to 3 attempts by default. You'll see it in the log:"

```
[16:47:22] Prompt #3 failed (attempt 1/3) — retrying...
[16:47:25] Retrying prompt #3 (attempt 2/3)
```

---

## 📣 CTA (2:00–2:30)

> "The Run Monitor gives you confidence that everything's working. No black-box automation — you see every step."
>
> "Next video — the Library Scanner, where you can browse and batch download all your generated videos."

---

## 📝 VIDEO DESCRIPTION

```
AutoFlow Run Monitor — Watch Your AI Videos Generate in Real Time

🔗 Install AutoFlow: [link]
🌐 Website: https://auto-flow.studio

See how AutoFlow's Run Monitor works:
- Real-time log of every automation action
- Pause / Resume / Stop / Skip / Retry controls
- Auto-retry on failures
- Progress tracking

Timestamps:
00:00 Hook
00:10 What is the Run Monitor?
00:30 Starting a run
00:50 Live log explained
01:20 Playback controls
01:45 Auto-retry
02:00 Next steps

#GoogleFlow #Automation #AIVideo #AutoFlow #RunMonitor
```
