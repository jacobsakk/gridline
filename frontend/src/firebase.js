// Firebase project config. These values identify the project (not secret
// credentials) -- access control comes entirely from the Firestore security
// rules deployed alongside this app (see firestore.rules): only signed-in,
// invited coaches can read or write anything.
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { app, db } from "./firebaseApp.js";

// The custom auth domain (auth.cmichrecruiting.com, so sign-in emails come from a domain this project controls) is
// set in firebaseApp.js with the rest of the config.
export { db };
export const auth = getAuth(app);
export const storage = getStorage(app);
