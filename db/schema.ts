import {sqliteTable,text,integer,index} from 'drizzle-orm/sqlite-core';
export const memberSessions=sqliteTable('member_sessions',{
 tokenHash:text('token_hash').primaryKey(),codeVersion:text('code_version').notNull(),expiresAt:integer('expires_at').notNull()
},t=>[index('member_sessions_expiry').on(t.expiresAt)]);
export const usageBuckets=sqliteTable('usage_buckets',{
 id:text('id').primaryKey(),count:integer('count').notNull(),expiresAt:integer('expires_at').notNull()
},t=>[index('usage_buckets_expiry').on(t.expiresAt)]);
