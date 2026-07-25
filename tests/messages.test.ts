import { describe, it, beforeEach, expect } from 'vitest'
import { createClient, type Client } from '@libsql/client'
import { sendMessage, getConversation, areFriends, isFollowing, hasRelationship, getRelationship, MAX_MESSAGE_LENGTH } from '../server/messages'

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
    CREATE TABLE follows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      follower_id INTEGER NOT NULL,
      followed_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(follower_id, followed_id)
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

async function makeFollow(db: Client, follower: number, followed: number) {
  await db.execute({
    sql: 'INSERT INTO follows (follower_id, followed_id) VALUES (?, ?)',
    args: [follower, followed],
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
    expect(await areFriends(userA, userB, db)).toBe(true)
    expect(await areFriends(userB, userA, db)).toBe(true)
  })

  it('areFriends returns false for non-friends', async () => {
    expect(await areFriends(userA, userB, db)).toBe(false)
  })

  it('areFriends returns false for pending requests', async () => {
    const [min, max] = userA < userB ? [userA, userB] : [userB, userA]
    await db.execute({
      sql: "INSERT INTO friends (user_a_id, user_b_id, status) VALUES (?, ?, 'pending')",
      args: [min, max],
    })
    expect(await areFriends(userA, userB, db)).toBe(false)
  })

  it('sendMessage persists message for friends', async () => {
    await makeFriends(db, userA, userB)
    const msg = await sendMessage(userA, userB, 'hello', db)
    expect(msg.text).toBe('hello')
    expect(msg.senderId).toBe(userA)
    expect(msg.recipientId).toBe(userB)
    expect(msg.id).toBeGreaterThan(0)
  })

  it('sendMessage rejects strangers', async () => {
    await expect(sendMessage(userA, userC, 'hello', db)).rejects.toThrow()
  })

  it('sendMessage allows self-messaging', async () => {
    const msg = await sendMessage(userA, userA, 'my note', db)
    expect(msg.text).toBe('my note')
    expect(msg.senderId).toBe(userA)
    expect(msg.recipientId).toBe(userA)
  })

  it('sendMessage truncates long text', async () => {
    await makeFriends(db, userA, userB)
    const longText = 'a'.repeat(1000)
    const msg = await sendMessage(userA, userB, longText, db)
    expect(msg.text.length).toBe(MAX_MESSAGE_LENGTH)
  })

  it('getConversation returns messages in chronological order', async () => {
    await makeFriends(db, userA, userB)
    await sendMessage(userA, userB, 'first', db)
    await sendMessage(userB, userA, 'second', db)
    await sendMessage(userA, userB, 'third', db)
    const msgs = await getConversation(userA, userB, 50, undefined, db)
    expect(msgs.length).toBe(3)
    expect(msgs[0].text).toBe('first')
    expect(msgs[1].text).toBe('second')
    expect(msgs[2].text).toBe('third')
  })

  it('getConversation returns self-messages', async () => {
    await sendMessage(userA, userA, 'note one', db)
    await sendMessage(userA, userA, 'note two', db)
    const msgs = await getConversation(userA, userA, 50, undefined, db)
    expect(msgs.length).toBe(2)
    expect(msgs[0].text).toBe('note one')
    expect(msgs[1].text).toBe('note two')
  })

  it('hasRelationship returns true for self', async () => {
    expect(await hasRelationship(userA, userA, db)).toBe(true)
  })

  it('getRelationship returns friend for self', async () => {
    expect(await getRelationship(userA, userA, db)).toBe('friend')
  })

  it('getConversation only returns messages between the pair', async () => {
    await makeFriends(db, userA, userB)
    await makeFriends(db, userA, userC)
    await sendMessage(userA, userB, 'to-b', db)
    await sendMessage(userA, userC, 'to-c', db)
    const msgs = await getConversation(userA, userB, 50, undefined, db)
    expect(msgs.length).toBe(1)
    expect(msgs[0].text).toBe('to-b')
  })

  it('getConversation respects limit', async () => {
    await makeFriends(db, userA, userB)
    await sendMessage(userA, userB, 'one', db)
    await sendMessage(userA, userB, 'two', db)
    await sendMessage(userA, userB, 'three', db)
    const msgs = await getConversation(userA, userB, 2, undefined, db)
    expect(msgs.length).toBe(2)
    expect(msgs[0].text).toBe('two')
    expect(msgs[1].text).toBe('three')
  })

  it('getConversation supports pagination with beforeId', async () => {
    await makeFriends(db, userA, userB)
    const m1 = await sendMessage(userA, userB, 'one', db)
    await sendMessage(userA, userB, 'two', db)
    await sendMessage(userA, userB, 'three', db)
    const msgs = await getConversation(userA, userB, 50, m1.id, db)
    expect(msgs.length).toBe(0)
  })

  it('isFollowing returns true when following', async () => {
    await makeFollow(db, userA, userB)
    expect(await isFollowing(userA, userB, db)).toBe(true)
    expect(await isFollowing(userB, userA, db)).toBe(false)
  })

  it('hasRelationship returns true for friends', async () => {
    await makeFriends(db, userA, userB)
    expect(await hasRelationship(userA, userB, db)).toBe(true)
  })

  it('hasRelationship returns true for following', async () => {
    await makeFollow(db, userA, userB)
    expect(await hasRelationship(userA, userB, db)).toBe(true)
  })

  it('hasRelationship returns true for follower', async () => {
    await makeFollow(db, userB, userA)
    expect(await hasRelationship(userA, userB, db)).toBe(true)
  })

  it('hasRelationship returns false for strangers', async () => {
    expect(await hasRelationship(userA, userC, db)).toBe(false)
  })

  it('getRelationship returns friend', async () => {
    await makeFriends(db, userA, userB)
    expect(await getRelationship(userA, userB, db)).toBe('friend')
  })

  it('getRelationship returns following', async () => {
    await makeFollow(db, userA, userB)
    expect(await getRelationship(userA, userB, db)).toBe('following')
  })

  it('getRelationship returns follower', async () => {
    await makeFollow(db, userB, userA)
    expect(await getRelationship(userA, userB, db)).toBe('follower')
  })

  it('getRelationship returns none', async () => {
    expect(await getRelationship(userA, userC, db)).toBe('none')
  })

  it('sendMessage works for follows', async () => {
    await makeFollow(db, userA, userB)
    const msg = await sendMessage(userA, userB, 'hi from follow', db)
    expect(msg.text).toBe('hi from follow')
  })

  it('sendMessage rejects strangers', async () => {
    await expect(sendMessage(userA, userC, 'hello', db)).rejects.toThrow()
  })
})
