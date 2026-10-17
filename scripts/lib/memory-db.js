/**
 * Minimal in-memory stand-in for the parts of the MongoDB driver this app
 * uses. Lets tests and `npm run dev` work without a database.
 *
 * Supported: insertOne, insertMany, find (projection, sort, skip, limit,
 * toArray), findOne, updateOne and findOneAndUpdate ($set, $inc, $setOnInsert,
 * upsert; returnDocument 'after'),
 * countDocuments, createIndex (no-op), deleteOne, deleteMany.
 * Query operators: equality, $ne, $exists, $gte, $gt, $lte, $lt.
 */

function compare(a, b) {
  if (a instanceof Date) a = a.getTime();
  if (b instanceof Date) b = b.getTime();
  return a < b ? -1 : a > b ? 1 : 0;
}

function matchesCondition(value, condition) {
  const isOperatorObject = condition && typeof condition === 'object' && !(condition instanceof Date) &&
    Object.keys(condition).every(k => k.startsWith('$'));
  if (!isOperatorObject) return compare(value, condition) === 0;

  return Object.entries(condition).every(([op, expected]) => {
    switch (op) {
      case '$ne': return value !== expected;
      case '$exists': return (value !== undefined) === Boolean(expected);
      case '$gte': return value !== undefined && compare(value, expected) >= 0;
      case '$gt': return value !== undefined && compare(value, expected) > 0;
      case '$lte': return value !== undefined && compare(value, expected) <= 0;
      case '$lt': return value !== undefined && compare(value, expected) < 0;
      default: throw new Error(`memory-db: unsupported operator ${op}`);
    }
  });
}

function matches(doc, query) {
  return Object.entries(query || {}).every(([key, condition]) => matchesCondition(doc[key], condition));
}

function project(doc, projection) {
  if (!projection || Object.keys(projection).length === 0) return Object.assign({}, doc);
  const entries = Object.entries(projection);
  const including = entries.some(([key, v]) => v && key !== '_id');
  let out;
  if (including) {
    out = {};
    entries.forEach(([key, v]) => {
      if (v && key in doc) out[key] = doc[key];
    });
    if (projection._id !== 0 && '_id' in doc) out._id = doc._id;
  } else {
    out = Object.assign({}, doc);
    entries.forEach(([key]) => delete out[key]);
  }
  return out;
}

function applyUpdate(doc, update) {
  Object.entries(update.$set || {}).forEach(([key, value]) => { doc[key] = value; });
  Object.entries(update.$inc || {}).forEach(([key, value]) => { doc[key] = (doc[key] || 0) + value; });
  Object.keys(update).filter(op => !['$set', '$inc', '$setOnInsert'].includes(op)).forEach(op => {
    throw new Error(`memory-db: unsupported update operator ${op}`);
  });
}

class Cursor {
  constructor(docs) {
    this.docs = docs;
  }

  sort(spec) {
    const keys = Object.entries(spec);
    this.docs.sort((a, b) => {
      for (const [key, dir] of keys) {
        const c = compare(a[key], b[key]);
        if (c !== 0) return c * dir;
      }
      return 0;
    });
    return this;
  }

  skip(n) {
    this.docs = this.docs.slice(n);
    return this;
  }

  limit(n) {
    this.docs = this.docs.slice(0, n);
    return this;
  }

  async toArray() {
    return this.docs;
  }
}

class Collection {
  constructor() {
    this.docs = [];
    this.nextId = 1;
  }

  async insertOne(doc) {
    if (!doc._id) doc._id = `mem_${this.nextId++}`;
    this.docs.push(Object.assign({}, doc));
    return { acknowledged: true, insertedId: doc._id };
  }

  async insertMany(docs) {
    for (const doc of docs) await this.insertOne(doc);
    return { acknowledged: true, insertedCount: docs.length };
  }

  find(query, options) {
    const projection = options && options.projection;
    return new Cursor(this.docs.filter(d => matches(d, query)).map(d => project(d, projection)));
  }

  async findOne(query) {
    const doc = this.docs.find(d => matches(d, query));
    return doc ? Object.assign({}, doc) : null;
  }

  async updateOne(query, update, options) {
    let doc = this.docs.find(d => matches(d, query));
    if (!doc) {
      if (!(options && options.upsert)) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      // Like MongoDB: equality fields of the query seed the new document.
      doc = {};
      Object.entries(query || {}).forEach(([key, cond]) => {
        if (!(cond && typeof cond === 'object' && !(cond instanceof Date))) doc[key] = cond;
      });
      Object.assign(doc, update.$setOnInsert || {});
      applyUpdate(doc, update);
      if (!doc._id) doc._id = `mem_${this.nextId++}`;
      this.docs.push(doc);
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: doc._id };
    }
    applyUpdate(doc, update);
    return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
  }

  /** Like the driver (v6+): returns the document itself, after the update with returnDocument: 'after'. */
  async findOneAndUpdate(query, update, options) {
    const before = this.docs.find(d => matches(d, query));
    const snapshot = before ? Object.assign({}, before) : null;
    const result = await this.updateOne(query, update, options);
    if (options && options.returnDocument === 'after') {
      const doc = before || this.docs.find(d => d._id === result.upsertedId);
      return doc ? Object.assign({}, doc) : null;
    }
    return snapshot;
  }

  async deleteOne(query) {
    const index = this.docs.findIndex(d => matches(d, query));
    if (index === -1) return { deletedCount: 0 };
    this.docs.splice(index, 1);
    return { deletedCount: 1 };
  }

  async countDocuments(query) {
    return this.docs.filter(d => matches(d, query)).length;
  }

  async deleteMany(query) {
    const before = this.docs.length;
    this.docs = this.docs.filter(d => !matches(d, query));
    return { deletedCount: before - this.docs.length };
  }

  async createIndex() {
    return 'memory-index';
  }
}

function createMemoryDb() {
  const collections = {};
  return {
    collection(name) {
      if (!collections[name]) collections[name] = new Collection();
      return collections[name];
    }
  };
}

module.exports = { createMemoryDb };
