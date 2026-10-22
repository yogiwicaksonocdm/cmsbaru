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
  const collections = new Map(); // nama koleksi -> Map(id -> data)
  const storeOf = (name) => {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  };

  const makeSnapshot = (id, data) => ({ id, exists: true, data: () => ({ ...data }) });

  function collection(name) {
    const store = storeOf(name);

    function runQuery(records) {
      return {
        where(field, _op, value) {
          if (_op !== '==') throw new Error(`Operator Firestore tidak didukung mock: ${_op}`);
          return runQuery(records.filter(([, data]) => data[field] === value));
        },
        orderBy(field) {
          const next = [...records].sort((a, b) =>
            String(b[1][field] || '').localeCompare(String(a[1][field] || '')),
          );
          return runQuery(next);
        },
        async get() {
          return { docs: records.map(([id, data]) => makeSnapshot(id, data)) };
        },
      };
    }

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
      where(field, op, value) {
        const records = [...store.entries()].filter(
          ([, data]) =>
            op === '==' &&
            data[field] === value,
        );
        return runQuery(records);
      },
      orderBy(field) {
        const records = [...store.entries()].sort((a, b) =>
          String(b[1][field] || '').localeCompare(String(a[1][field] || '')),
        );
        return runQuery(records);
      },
      // get() langsung tanpa query (dipakai beberapa pola lama)
      async get() {
        return { docs: [...store.entries()].map(([id, data]) => makeSnapshot(id, data)) };
      },
    };
  }

  let counter = 0;
  return {
    collection,
    _collections: collections, // untuk pemeriksaan/seed manual
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
