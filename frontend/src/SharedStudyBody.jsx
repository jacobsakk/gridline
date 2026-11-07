import { ALL_STUDIES, StudyDetail } from "./StudiesPage.jsx";

// The study inside a share link: loaded on its own, apart from the page around it, because it pulls in all the study code.
export default function SharedStudyBody({ share, token }) {
  const meta = ALL_STUDIES.find((s) => s.id === share.studyId);
  if (!meta) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>This link isn't active. Ask whoever sent it for a new one.</div>;
  return meta.detail ? (
    <meta.detail canEdit={false} meta={meta} snapshot={share.data} shareToken={token} />
  ) : (
    <StudyDetail studyId={share.studyId} canEdit={false} snapshot={share.data} shareToken={token} />
  );
}
