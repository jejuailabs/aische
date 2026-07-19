// ==========================================
// Firebase 클라이언트 SDK 초기화 (클라이언트 전용)
// ==========================================
// SSR/프리렌더링 중에는 초기화하지 않음 — getAuth()/getFirestore()를
// 모듈 최상위에서 호출하면 빌드 시 invalid-api-key 에러 발생.

import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

function getFirebaseApp(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

// 브라우저에서만 초기화되는 lazy singleton
let _auth: Auth | null = null;
let _db: Firestore | null = null;

export function getClientAuth(): Auth {
  if (!_auth) _auth = getAuth(getFirebaseApp());
  return _auth;
}

export function getClientDb(): Firestore {
  if (!_db) _db = getFirestore(getFirebaseApp());
  return _db;
}

export const googleProvider = new GoogleAuthProvider();

// 하위 호환용 — 기존 import { auth, db } 패턴 대체
// 이 getter들은 클라이언트 컴포넌트에서만 호출되므로 안전
export const auth = typeof window !== "undefined"
  ? getClientAuth()
  : (null as unknown as Auth);

export const db = typeof window !== "undefined"
  ? getClientDb()
  : (null as unknown as Firestore);
