/* ============================================================
   AutoFlow Studio — Main App Component
   Routes between Template Gallery and Canvas views
   ============================================================ */

import { useEffect } from 'react';
import { useStudioStore } from './store';
import TemplateGallery from './components/TemplateGallery';
import Canvas from './components/Canvas';
import './studio.css';

export default function App() {
  const { view } = useStudioStore();

  /* Load last workflow on mount */
  useEffect(() => {
    // Don't auto-load — start at gallery
  }, []);

  return (
    <div className="studio-app">
      {view === 'gallery' ? <TemplateGallery /> : <Canvas />}
    </div>
  );
}
