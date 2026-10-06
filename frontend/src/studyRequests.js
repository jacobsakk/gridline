import { collection, deleteDoc, doc, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { useEffect, useState } from "react";
import { db, storage } from "./firebase";

// "Request a study" -- a place on the Studies page itself (instead of only asking in chat) for any
// coach to ask for a new study, point-blank describing what they want and optionally attaching an
// example file (a spreadsheet mocking up the layout, a screenshot). Only admins see the queue; see
// firestore.rules / storage.rules for the access rules this relies on.
export async function submitStudyRequest({ title, description, file, by }) {
  if (!title.trim()) throw Object.assign(new Error("Give the study a title."), { code: "bad-request" });
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  let fileUrl = "";
  let fileName = "";
  if (file) {
    const path = `studyRequests/${id}/${file.name}`;
    await uploadBytes(ref(storage, path), file);
    fileUrl = await getDownloadURL(ref(storage, path));
    fileName = file.name;
  }
  await setDoc(doc(db, "studyRequests", id), {
    title: title.trim(),
    description: (description || "").trim(),
    fileUrl,
    fileName,
    by,
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  return id;
}

// Admin-only queue of pending requests -- see them above and dismiss (mark done) once a study is built.
export function useStudyRequests(admin) {
  const [requests, setRequests] = useState({});
  useEffect(() => {
    if (!admin) return;
    const off = onSnapshot(
      collection(db, "studyRequests"),
      (snap) => {
        const map = {};
        snap.docs.forEach((d) => {
          map[d.id] = { id: d.id, ...d.data() };
        });
        setRequests(map);
      },
      () => {}
    );
    return off;
  }, [admin]);

  const pending = Object.values(requests)
    .filter((r) => r.status === "pending")
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

  return {
    pending,
    async markDone(id) {
      await updateDoc(doc(db, "studyRequests", id), { status: "done" });
    },
    async remove(id) {
      await deleteDoc(doc(db, "studyRequests", id));
    },
  };
}
