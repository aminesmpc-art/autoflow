// Local test entry only; never part of the extension build.
import { createRoot } from 'react-dom/client';
import Canvas from '../../src/studio/components/Canvas';
import { useStudioStore } from '../../src/studio/store';
import '../../src/studio/studio.css';

(window as any).connectionTest = {
  state: () => ({ nodes: useStudioStore.getState().nodes, edges: useStudioStore.getState().edges }),
  removeEdge: (id: string) => useStudioStore.getState().removeEdge(id),
  update: (id: string, data: Record<string, unknown>) => useStudioStore.getState().updateNodeData(id, data),
};
async function start() {
  const text = await (await fetch('/workflow.json')).text();
  await useStudioStore.getState().importWorkflow(new File([text], 'studio-connection-test.json', { type: 'application/json' }));
  createRoot(document.getElementById('root')!).render(<div className="studio-app"><Canvas /></div>);
}
void start();
