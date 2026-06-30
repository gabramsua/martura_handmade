export const environment = {
  production: false,
  firebase: {
    enabled: false,
    adminEmails: ['admin@martura.test'],
    useEmulators: false,
    config: {
      apiKey: '',
      authDomain: '',
      projectId: '',
      storageBucket: '',
      messagingSenderId: '',
      appId: '',
    },
    emulators: {
      authHost: '127.0.0.1',
      authPort: 9099,
      firestoreHost: '127.0.0.1',
      firestorePort: 8080,
    },
  },
} as const;
