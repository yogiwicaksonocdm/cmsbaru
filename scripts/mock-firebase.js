/**
 * Mock firebase-admin (Firestore in-memory) untuk pengembangan lokal
 * dan smoke test — dipakai HANYA ketika kredensial Firebase tidak ada.
 *
 * Cara pakai:
 *   require('./mock-firebase').install();
 *   const app = require('../api/index');
 */
const path = require('path');

function createMockFirestore() {
  const store = new Map(); // id -> data
  let counter = 0;

  const makeSnapshot = (id, data) => ({ id, exists: true, data: () => ({ ...data }) });

  return {
    collection() {
      return {
        async add(data) {
          const id = `mock-${String(++counter).padStart(4, '0')}`;
          store.set(id, { ...data });
          return { id };
        },
        doc(id) {
          return {
            id,
            async get() {
              if (!store.has(id)) return { id, exists: false, data: () => undefined };
              return makeSnapshot(id, store.get(id));
            },
            async update(patch) {
              if (!store.has(id)) throw new Error(`Dokumen ${id} tidak ditemukan.`);
              store.set(id, { ...store.get(id), ...patch });
            },
            async set(data) {
              store.set(id, { ...data });
            },
            async delete() {
              store.delete(id);
            },
          };
        },
        orderBy() {
          return {
            async get() {
              const docs = [...store.entries()]
                .map(([id, data]) => makeSnapshot(id, data))
                .sort((a, b) => String(b.data().createdAt || '').localeCompare(String(a.data().createdAt || '')));
              return { docs };
            },
          };
        },
      };
    },
  };
}

/** Suntikkan mock firebase-admin ke require cache SEBELUM api/index.js dimuat.
 *  `options.seedPosts` (opsional): array { title, content, author, published } untuk preview lokal.
 */
function install(options = {}) {
  let adminPath;
  try {
    adminPath = require.resolve('firebase-admin');
  } catch (error) {
    adminPath = path.join(__dirname, '..', 'node_modules', 'firebase-admin', 'lib', 'index.js');
  }

  const apps = [];
  const firestoreInstance = createMockFirestore();
  const mockAdmin = {
    get apps() {
      return apps;
    },
    initializeApp() {
      apps.push({ name: '[DEFAULT]' });
      return apps[0];
    },
    credential: { cert: (creds) => ({ ...creds, getCertificate: () => creds }) },
    firestore: () => firestoreInstance,
  };

  // Seed contoh data (hanya untuk preview lokal)
  (options.seedPosts || []).forEach((post) => {
    const now = new Date().toISOString();
    firestoreInstance.collection('posts').add({ author: 'Admin', published: true, ...post, createdAt: now, updatedAt: now });
  });

  require.cache[adminPath] = {
    id: adminPath,
    filename: adminPath,
    loaded: true,
    exports: mockAdmin,
    children: [],
    paths: [],
  };

  return mockAdmin;
}

module.exports = { install };
