export const environment = {
  production: false,
  firebase: {
    enabled: true,
    adminEmails: ['gabramsua@gmail.com'],
    useEmulators: false,
    config: {
      apiKey: "AIzaSyB6_4iJHwKebbeXrVN0DECQemOkUGJlvjQ",
      authDomain: "martura-handmade.firebaseapp.com",
      projectId: "martura-handmade",
      storageBucket: "martura-handmade.firebasestorage.app",
      messagingSenderId: "559622225888",
      appId: "1:559622225888:web:202ae07b9cbf6d81d2f585",
      measurementId: "G-EJJWT5CDHT"
    },
    emulators: {
      authHost: '127.0.0.1',
      authPort: 9099,
      firestoreHost: '127.0.0.1',
      firestorePort: 8080,
      storageHost: '127.0.0.1',
      storagePort: 9199,
    },
  },
} as const;
