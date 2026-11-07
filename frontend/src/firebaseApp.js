// Firebase project config and the Firestore database, on their own -- the sign-in and file-storage parts are in
// firebase.js. A shared link only needs the database, so it imports this and skips the rest.
import { getApp, getApps, initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { firebaseConfig } from "./firebaseConfig.js";


export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);
