import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "./firebase";
import type { ExtractedInfo, HomepagePost } from "./extractor";

export type SavedNotice = {
  id: string;
  userId: string;
  title: string;
  category: string;
  body: string;
  copyText: string;
  sourceMail: string;
  extractedInfo: ExtractedInfo;
  createdAtMs: number;
};

type SavedNoticeDoc = Omit<SavedNotice, "id">;

const noticesCollection = collection(db, "notices");

export async function saveNoticeDraft(params: {
  userId: string;
  post: HomepagePost;
  sourceMail: string;
  extractedInfo: ExtractedInfo;
}) {
  const createdAtMs = Date.now();
  const doc = await addDoc(noticesCollection, {
    userId: params.userId,
    title: params.post.title,
    category: params.post.category,
    body: params.post.body,
    copyText: params.post.copyText,
    sourceMail: params.sourceMail,
    extractedInfo: params.extractedInfo,
    createdAtMs,
    createdAt: serverTimestamp(),
  });

  return {
    id: doc.id,
    userId: params.userId,
    title: params.post.title,
    category: params.post.category,
    body: params.post.body,
    copyText: params.post.copyText,
    sourceMail: params.sourceMail,
    extractedInfo: params.extractedInfo,
    createdAtMs,
  };
}

export async function loadNoticeDrafts(userId: string) {
  const snapshot = await getDocs(
    query(
      noticesCollection,
      where("userId", "==", userId),
      orderBy("createdAtMs", "desc"),
      limit(20),
    ),
  );

  return snapshot.docs.map((doc) => {
    const data = doc.data() as SavedNoticeDoc;
    return {
      id: doc.id,
      ...data,
    };
  });
}
