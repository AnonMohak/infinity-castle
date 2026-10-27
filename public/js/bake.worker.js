// Builds and bakes kit pieces off the main thread; the arrays go back as transferables.
import { buildPiece } from './kit.js';

self.onmessage = (e) => {
  const r = buildPiece(e.data.spec);
  self.postMessage({ id: e.data.id, r }, [r.P.buffer, r.N.buffer, r.UV.buffer, r.MA.buffer, r.LI.buffer, r.DR.buffer, r.I.buffer, r.lights.buffer]);
};
