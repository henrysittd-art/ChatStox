import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Real Firebase project config created dynamically for chat-stox
const firebaseConfig = {
  apiKey:            'AIzaSyBRdq5VRS5xUAU75lBmA7N-a09u86XhDNk',
  authDomain:        'chat-stox.firebaseapp.com',
  projectId:         'chat-stox',
  storageBucket:     'chat-stox.firebasestorage.app',
  messagingSenderId: '748694272456',
  appId:             '1:748694272456:web:8b4f8d7c595f46a9ac28fd',
};

const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;
