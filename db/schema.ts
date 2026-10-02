import {sqliteTable,text,integer,index,uniqueIndex,primaryKey} from 'drizzle-orm/sqlite-core';
export const memberSessions=sqliteTable('member_sessions',{
 tokenHash:text('token_hash').primaryKey(),codeVersion:text('code_version').notNull(),expiresAt:integer('expires_at').notNull()
},t=>[index('member_sessions_expiry').on(t.expiresAt)]);
export const usageBuckets=sqliteTable('usage_buckets',{
 id:text('id').primaryKey(),count:integer('count').notNull(),expiresAt:integer('expires_at').notNull()
},t=>[index('usage_buckets_expiry').on(t.expiresAt)]);
export const accounts=sqliteTable('accounts',{
 id:text('id').primaryKey(),provider:text('provider').notNull(),subjectHash:text('subject_hash').notNull(),label:text('label').notNull(),createdAt:integer('created_at').notNull()
},t=>[uniqueIndex('accounts_identity').on(t.provider,t.subjectHash)]);
export const accountSessions=sqliteTable('account_sessions',{
 tokenHash:text('token_hash').primaryKey(),accountId:text('account_id').notNull().references(()=>accounts.id),expiresAt:integer('expires_at').notNull()
},t=>[index('account_sessions_expiry').on(t.expiresAt)]);
export const accountClasses=sqliteTable('account_classes',{
 accountId:text('account_id').notNull().references(()=>accounts.id),id:text('id').notNull(),title:text('title').notNull(),createdAt:text('created_at').notNull(),status:text('status').notNull(),segmentCount:integer('segment_count').notNull(),demo:integer('demo').notNull(),objectKey:text('object_key').notNull(),revision:integer('revision').notNull()
},t=>[primaryKey({columns:[t.accountId,t.id]}),index('account_classes_history').on(t.accountId,t.createdAt)]);
export const accountMaterials=sqliteTable('account_materials',{
 accountId:text('account_id').notNull().references(()=>accounts.id),classId:text('class_id').notNull(),id:text('id').notNull(),objectKey:text('object_key').notNull()
},t=>[primaryKey({columns:[t.accountId,t.classId,t.id]})]);
