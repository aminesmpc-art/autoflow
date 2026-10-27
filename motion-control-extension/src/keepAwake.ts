/* "Is it going to work if I set up all the things and go do other things?"

   Not if the computer goes to sleep: Windows sleeps an idle machine, and a
   sleeping machine stops the job wherever it was. So a job holds the computer
   awake from Generate until it ends. 'system' level keeps the computer awake
   but still lets the screen turn off.

   The request belongs to the extension, not to this page, so it outlives a
   closed panel. It is released when the job ends, when the panel goes away,
   and when a panel opens with no job running: a request left behind would
   keep the computer awake for nothing.

   Plain `chrome.power.` calls, never optional chaining: tests/package.test.ts
   proves the permission is used by finding exactly that text in the build. */
export function holdAwake(): void {
  try { chrome.power.requestKeepAwake('system'); } catch { /* without the API the job still runs */ }
}

export function letSleep(): void {
  try { chrome.power.releaseKeepAwake(); } catch { /* nothing was held */ }
}
