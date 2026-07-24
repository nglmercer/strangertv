import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createClient, type Client } from '@libsql/client'
import { sendMessage, getConversation, areFriends, MAX_MESSAGE_LENGTH } from './messages'

async function setupDb(): Promise<Client> {
  const db = createClient({ url: 'file::memory:' })
  await db.execute(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      birth_date TEXT,
      gender TEXT DEFAULT 'any',
      country TEXT DEFAULT 'any',
      language TEXT DEFAULT 'any',
      interests TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await db.execute(`
    CREATE TABLE friends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_a_id INTEGER NOT NULL,
      user_b_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_a_id, user_b_id)
    )
  `)
  await db.execute(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      recipient_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sender_id) REFERENCES users(id),
      FOREIGN KEY (recipient_id) REFERENCES users(id)
    )
  `)
  return db
}

async function createUser(db: Client, email: string): Promise<number> {
  const result = await db.execute({
    sql: 'INSERT INTO users (email, password_hash) VALUES (?, ?)',
    args: [email, 'hash'],
  })
  return Number(result.lastInsertRowid)
}

async function makeFriends(db: Client, userA: number, userB: number) {
  const [min, max] = userA < userB ? [userA, userB] : [userB, userA]
  await db.execute({
    sql: "INSERT INTO friends (user_a_id, user_b_id, status) VALUES (?, ?, 'accepted')",
    args: [min, max],
  })
}

describe('messages', () => {
  let db: Client
  let userA: number
  let userB: number
  let userC: number

  beforeEach(async () => {
    db = await setupDb()
    userA = await createUser(db, 'a@test.com')
    userB = await createUser(db, 'b@test.com')
    userC = await createUser(db, 'c@test.com')
  })

  it('areFriends returns true for accepted friends', async () => {
    await makeFriends(db, userA, userB)
    assert.equal(await areFriends(userA, userB, db), true)
    assert.equal(await areFriends(userB, userA, db), true)
  })

  it('areFriends returns false for non-friends', async () => {
    assert.equal(await areFriends(userA, userB, db), false)
  })

  it('areFriends returns false for pending requests', async () => {
    const [min, max] = userA < userB ? [userA, userB] : [userB, userA]
    await db.execute({
      sql: "INSERT INTO friends (user_a_id, user_b_id, status) VALUES (?, ?, 'pending')",
      args: [min, max],
    })
    assert.equal(await areFriends(userA, userB, db), false)
  })

  it('sendMessage persists message for friends', async () => {
    await makeFriends(db, userA, userB)
    const msg = await sendMessage(userA, userB, 'hello', db)
    assert.equal(msg.text, 'hello')
    assert.equal(msg.senderId, userA)
    assert.equal(msg.recipientId, userB)
    assert.ok(msg.id > 0)
  })

  it('sendMessage rejects non-friends', async () => {
    await assert.rejects(() => sendMessage(userA, userC, 'hello', db))
  })

  it('sendMessage rejects self-messaging', async () => {
    await assert.rejects(() => sendMessage(userA, userA, 'hello', db))
  })

  it('sendMessage truncates long text', async () => {
    await makeFriends(db, userA, userB)
    const longText = 'a'.repeat(1000)
    const msg = await sendMessage(userA, userB, longText, db)
    assert.equal(msg.text.length, MAX_MESSAGE_LENGTH)
  })

  it('getConversation returns messages in chronological order', async () => {
    await makeFriends(db, userA, userB)
    await sendMessage(userA, userB, 'first', db)
    await sendMessage(userB, userA, 'second', db)
    await sendMessage(userA, userB, 'third', db)
    const msgs = await getConversation(userA, userB, 50, undefined, db)
    assert.equal(msgs.length, 3)
    assert.equal(msgs[0].text, 'first')
    assert.equal(msgs[1].text, 'second')
    assert.equal(msgs[2].text, 'third')
  })

  it('getConversation only returns messages between the pair', async () => {
    await makeFriends(db, userA, userB)
    await makeFriends(db, userA, userC)
    await sendMessage(userA, userB, 'to-b', db)
    await sendMessage(userA, userC, 'to-c', db)
    const msgs = await getConversation(userA, userB, 50, undefined, db)
    assert.equal(msgs.length, 1)
    assert.equal(msgs[0].text, 'to-b')
  })

  it('getConversation respects limit', async () => {
    await makeFriends(db, userA, userB)
    await sendMessage(userA, userB, 'one', db)
    await sendMessage(userA, userB, 'two', db)
    await sendMessage(userA, userB, 'three', db)
    const msgs = await getConversation(userA, userB, 2, undefined, db)
    assert.equal(msgs.length, 2)
    assert.equal(msgs[0].text, 'two')
    assert.equal(msgs[1].text, 'three')
  })

  it('getConversation supports pagination with beforeId', async () => {
    await makeFriends(db, userA, userB)
    const m1 = await sendMessage(userA, userB, 'one', db)
    await sendMessage(userA, userB, 'two', db)
    await sendMessage(userA, userB, 'three', db)
    const msgs = await getConversation(userA, userB, 50, m1.id, db)
    assert.equal(msgs.length, 0)
  })
})
