import { sql, relations } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
  text,
  pgEnum,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table (required for Replit Auth)
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

// User storage table (required for Replit Auth)
export const users = pgTable("users", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Tag category enum
export const tagCategoryEnum = pgEnum("tag_category", [
  "分類",
  "角度",
  "パーツ",
  "自由",
]);

// Tags table
export const tags = pgTable(
  "tags",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    category: tagCategoryEnum("category").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    uniqueNameCategory: index("unique_name_category").on(
      table.name,
      table.category
    ),
  })
);

// Posts table
export const posts = pgTable("posts", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  imageUrl: text("image_url").notNull(),
  caption: text("caption"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Post-tags junction table
export const postTags = pgTable(
  "post_tags",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "restrict" }),
  },
  (table) => ({
    pk: index("post_tags_pk").on(table.postId, table.tagId),
  })
);

// Favorites table
export const favorites = pgTable(
  "favorites",
  {
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    pk: index("favorites_pk").on(table.userId, table.postId),
  })
);

// User exclude tags table (for zoning feature)
export const userExcludeTags = pgTable(
  "user_exclude_tags",
  {
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    pk: index("user_exclude_tags_pk").on(table.userId, table.tagId),
  })
);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
  favorites: many(favorites),
  excludeTags: many(userExcludeTags),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
  user: one(users, {
    fields: [posts.userId],
    references: [users.id],
  }),
  postTags: many(postTags),
  favorites: many(favorites),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  postTags: many(postTags),
  userExcludeTags: many(userExcludeTags),
}));

export const postTagsRelations = relations(postTags, ({ one }) => ({
  post: one(posts, {
    fields: [postTags.postId],
    references: [posts.id],
  }),
  tag: one(tags, {
    fields: [postTags.tagId],
    references: [tags.id],
  }),
}));

export const favoritesRelations = relations(favorites, ({ one }) => ({
  user: one(users, {
    fields: [favorites.userId],
    references: [users.id],
  }),
  post: one(posts, {
    fields: [favorites.postId],
    references: [posts.id],
  }),
}));

export const userExcludeTagsRelations = relations(
  userExcludeTags,
  ({ one }) => ({
    user: one(users, {
      fields: [userExcludeTags.userId],
      references: [users.id],
    }),
    tag: one(tags, {
      fields: [userExcludeTags.tagId],
      references: [tags.id],
    }),
  })
);

// Insert schemas
export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  firstName: true,
  lastName: true,
  profileImageUrl: true,
});

export const insertPostSchema = createInsertSchema(posts).omit({
  id: true,
  createdAt: true,
});

export const insertTagSchema = createInsertSchema(tags).omit({
  id: true,
  createdAt: true,
});

// Types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type PostTag = typeof postTags.$inferSelect;
export type Favorite = typeof favorites.$inferSelect;
export type UserExcludeTag = typeof userExcludeTags.$inferSelect;
export type InsertPost = z.infer<typeof insertPostSchema>;
export type InsertTag = z.infer<typeof insertTagSchema>;
export type TagCategory = "分類" | "角度" | "パーツ" | "自由";

// Extended types for API responses
export type PostWithTags = Post & {
  tags: Tag[];
  user: User;
  isFavorited?: boolean;
};
