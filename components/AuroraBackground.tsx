// A calm, slowly-drifting backdrop for the home screen — three soft blue tonal
// pools breathing behind the search box. Purely decorative, so it's aria-hidden
// and never intercepts pointers; the motion pauses entirely under
// prefers-reduced-motion. All styling lives in globals.css under `.aurora`.
export default function AuroraBackground() {
  return (
    <div className="aurora" aria-hidden="true">
      <span className="aurora-blob aurora-1" />
      <span className="aurora-blob aurora-2" />
      <span className="aurora-blob aurora-3" />
    </div>
  );
}
