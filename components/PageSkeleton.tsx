// Loading placeholders shaped like the screen that is about to appear, so a tap never shows a pile of grey boxes that
// look nothing like the page. One variant per screen; each route's loading.tsx picks its own.
import "./PageSkeleton.css";

export type SkeletonKind = "scanner" | "token" | "quests" | "admin" | "traders" | "profile";

const B = ({ w, h, r = 10, className = "" }: { w?: number | string; h: number | string; r?: number; className?: string }) => (
  <div className={`wsk-b ${className}`} style={{ width: w ?? "100%", height: h, borderRadius: r }} />
);

// The real top bar stays mounted in the app shell, so a loading screen only keeps its space free.
function Bar() {
  return <div className="wraith-app-header wx-header-spacer" aria-hidden="true" />;
}

function Scanner() {
  return (
    <div className="sk-pad">
      <div className="sk-chips">{[92, 70, 84, 64, 76].map((w, i) => <B key={i} w={w} h={34} r={17} />)}</div>
      <div className="sk-cards">
        {Array.from({ length: 9 }, (_, i) => (
          <div className="sk-card" key={i}>
            <B w={44} h={44} r={22} />
            <div className="sk-lines"><B w="55%" h={13} r={5} /><B w="35%" h={10} r={5} /></div>
            <div className="sk-lines sk-right"><B w={64} h={13} r={5} /><B w={44} h={10} r={5} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Token() {
  return (
    <div className="sk-token">
      <aside className="sk-side sk-desk">
        <B h={36} r={10} />
        {Array.from({ length: 9 }, (_, i) => (
          <div className="sk-card flat" key={i}><B w={32} h={32} r={16} /><div className="sk-lines"><B w="60%" h={11} r={5} /><B w="38%" h={9} r={5} /></div><B w={52} h={11} r={5} /></div>
        ))}
      </aside>
      <section className="sk-center">
        <div className="sk-id">
          <B w={56} h={56} r={28} />
          <div className="sk-lines"><B w={150} h={22} r={6} /><B w={190} h={14} r={6} /></div>
          <B w={44} h={44} r={12} />
        </div>
        <div className="sk-row">{[0, 1, 2, 3, 4].map((i) => <B key={i} w={42} h={38} r={10} />)}</div>
        <div className="sk-lines"><B w={84} h={10} r={5} /><B w={190} h={34} r={8} /></div>
        <div className="sk-stats">{[0, 1, 2, 3].map((i) => <div key={i} className="sk-lines mid"><B w={28} h={10} r={5} /><B w={62} h={14} r={5} /></div>)}</div>
        <B h={96} r={14} />
        <div className="sk-row">{[38, 38, 44, 38, 38, 38, 58, 58].map((w, i) => <B key={i} w={w} h={34} r={9} />)}</div>
        <B h="clamp(260px, 46vh, 520px)" r={12} />
      </section>
      <aside className="sk-dockcol sk-desk">
        <B h={44} r={10} /><B h={40} r={10} /><B h={56} r={10} /><B h={48} r={10} /><B h={150} r={12} />
      </aside>
      <div className="sk-mbar sk-mob"><B w={84} h={52} r={12} /><B h={52} r={12} /><B h={52} r={12} /></div>
    </div>
  );
}

function Quests({ narrow = false }: { narrow?: boolean }) {
  return (
    <div className={`sk-quests${narrow ? " narrow" : ""}`}>
      <div className="sk-hero">
        <B w={170} h={12} r={5} />
        <B w="min(520px, 80%)" h="clamp(40px, 9vw, 68px)" r={10} />
        <B w="min(600px, 95%)" h={14} r={6} />
        <div className="sk-stat4">{[0, 1, 2, 3].map((i) => <B key={i} h={72} r={12} />)}</div>
      </div>
      {narrow
        ? <><B h={48} r={14} /><B h={320} r={16} /><B h={260} r={16} /></>
        : (
          <div className="sk-qgrid">
            <div className="sk-col"><B h={300} r={16} /><B h={150} r={16} /><B h={190} r={16} /></div>
            <div className="sk-col"><B h={230} r={16} /><B h={120} r={16} /><B h={200} r={16} /></div>
          </div>
        )}
    </div>
  );
}

function Traders() {
  return (
    <div className="sk-pad">
      <B w={220} h={30} r={8} />
      <B h={44} r={12} />
      <div className="sk-tgrid">{Array.from({ length: 9 }, (_, i) => <B key={i} h={150} r={16} />)}</div>
    </div>
  );
}

function Profile() {
  return (
    <div className="sk-pad sk-profile">
      <div className="wsk-b wsk-cover" />
      <div className="wsk-id">
        <div className="wsk-b wsk-av" />
        <div className="wsk-lines"><B w={170} h={18} r={6} /><B w={110} h={12} r={6} /></div>
      </div>
      <div className="wsk-grid">{[0, 1, 2].map((i) => <div key={i} className="wsk-b" />)}</div>
      <B h={220} r={16} />
    </div>
  );
}

export default function PageSkeleton({ kind }: { kind: SkeletonKind }) {
  return (
    <div className="sk-page" aria-busy="true" aria-label="Loading">
      <Bar />
      {kind === "scanner" && <Scanner />}
      {kind === "token" && <Token />}
      {kind === "quests" && <Quests />}
      {kind === "admin" && <Quests narrow />}
      {kind === "traders" && <Traders />}
      {kind === "profile" && <Profile />}
    </div>
  );
}
