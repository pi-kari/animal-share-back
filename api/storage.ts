import {
  users,
  posts,
  tags,
  postTags,
  favorites,
  userExcludeTags,
  type User,
  type UpsertUser,
  type Post,
  type Tag,
  type PostWithTags,
  type InsertPost,
  type InsertTag,
  type TagCategory,
} from "./schema";
import { db } from "./db";
import { eq, and, inArray, sql, desc, count, notInArray } from "drizzle-orm";

export interface IStorage {
  // User operations (required for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;

  // Tag operations
  getAllTags(): Promise<Tag[]>;
  getTagsByCategory(category: TagCategory): Promise<Tag[]>;
  createTag(tag: InsertTag): Promise<Tag>;
  getOrCreateTag(name: string, category: TagCategory): Promise<Tag>;

  // Post operations
  getPosts(
    limit?: number,
    offset?: number,
    tagIds?: string[],
    userId?: string
  ): Promise<PostWithTags[]>;
  getPost(id: string, userId?: string): Promise<PostWithTags | undefined>;
  createPost(post: InsertPost, tagIds: string[]): Promise<Post>;
  deletePost(id: string, userId: string): Promise<boolean>;

  // Favorite operations
  addFavorite(userId: string, postId: string): Promise<void>;
  removeFavorite(userId: string, postId: string): Promise<void>;
  getUserFavorites(
    userId: string,
    limit?: number,
    offset?: number
  ): Promise<PostWithTags[]>;

  // Exclude tag operations (zoning)
  addExcludeTag(userId: string, tagId: string): Promise<void>;
  removeExcludeTag(userId: string, tagId: string): Promise<void>;
  getUserExcludeTags(userId: string): Promise<Tag[]>;

  // Validation
  validatePostTags(tagIds: string[]): Promise<boolean>;
}

// @ts-ignore
export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.email,
        set: {
          firstName: userData.firstName,
          lastName: userData.lastName,
          profileImageUrl: userData.profileImageUrl,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user!;
  }

  async getAllTags(): Promise<Tag[]> {
    return await db.select().from(tags).orderBy(tags.category, tags.name);
  }

  async getTagsByCategory(category: TagCategory): Promise<Tag[]> {
    return await db
      .select()
      .from(tags)
      .where(eq(tags.category, category))
      .orderBy(tags.name);
  }

  async createTag(tag: InsertTag): Promise<Tag> {
    const [newTag] = await db.insert(tags).values(tag).returning();
    // @ts-ignore
    return newTag;
  }

  async getOrCreateTag(name: string, category: TagCategory): Promise<Tag> {
    const [existingTag] = await db
      .select()
      .from(tags)
      .where(and(eq(tags.name, name), eq(tags.category, category)));

    if (existingTag) {
      return existingTag;
    }

    return await this.createTag({ name, category });
  }

  // @ts-ignore
  async getPosts(
    limit: number = 20,
    offset: number = 0,
    tagIds?: string[],
    userId?: string,
    excludeTagIds?: string[] // ← 追加
  ): Promise<PostWithTags[]> {
    const isFavoritedExpr = userId
      ? sql<boolean>`CASE WHEN ${favorites.userId} IS NOT NULL THEN true ELSE false END`
      : sql<boolean>`false`;

    let query = db
      .select({
        post: posts,
        user: users,
        tag: tags,
        isFavorited: isFavoritedExpr,
      })
      .from(posts)
      .leftJoin(users, eq(posts.userId, users.id))
      .leftJoin(postTags, eq(posts.id, postTags.postId))
      .leftJoin(tags, eq(postTags.tagId, tags.id));

    // favorites は userId がある場合だけ結合する
    if (userId) {
      query = query.leftJoin(
        favorites,
        and(eq(favorites.postId, posts.id), eq(favorites.userId, userId))
      );
    }

    // タグでの AND フィルタ
    if (tagIds && tagIds.length > 0) {
      const postsWithAllTags = db
        .select({ postId: postTags.postId })
        .from(postTags)
        .where(inArray(postTags.tagId, tagIds))
        .groupBy(postTags.postId)
        .having(eq(count(), tagIds.length));

      // @ts-ignore
      query = query.where(inArray(posts.id, postsWithAllTags));
    }

    // フロントから渡された除外タグ（excludeTagIds）でフィルタ
    if (excludeTagIds && excludeTagIds.length > 0) {
      const postsWithExcludedTags = db
        .select({ postId: postTags.postId })
        .from(postTags)
        .where(inArray(postTags.tagId, excludeTagIds));

      // @ts-ignore
      query = query.where(notInArray(posts.id, postsWithExcludedTags));
    }

    // また、ユーザーが自身で設定した除外タグ（userExcludeTags テーブル）もサポート（既存のロジック）
    if (userId) {
      const excludedTagIds = db
        .select({ tagId: userExcludeTags.tagId })
        .from(userExcludeTags)
        .where(eq(userExcludeTags.userId, userId));

      const postsWithUserExcludedTags = db
        .select({ postId: postTags.postId })
        .from(postTags)
        .where(inArray(postTags.tagId, excludedTagIds));

      // @ts-ignore
      query = query.where(notInArray(posts.id, postsWithUserExcludedTags));
    }

    const results = await query
      .orderBy(desc(posts.createdAt))
      .limit(limit)
      .offset(offset);

    // Grouping/collect tags (既存ロジックをそのまま)
    const postsMap = new Map<string, PostWithTags>();

    for (const result of results) {
      const postId = result.post.id;

      if (!postsMap.has(postId)) {
        postsMap.set(postId, {
          ...result.post,
          user: result.user!,
          tags: [],
          isFavorited: result.isFavorited,
        });
      }

      if (result.tag) {
        const existingPost = postsMap.get(postId)!;
        if (!existingPost.tags.some((t) => t.id === result.tag!.id)) {
          existingPost.tags.push(result.tag);
        }
      }
    }

    return Array.from(postsMap.values());
  }

  async getPost(
    id: string,
    userId?: string
  ): Promise<PostWithTags | undefined> {
    const isFavoritedExpr = userId
      ? sql<boolean>`CASE WHEN ${favorites.userId} IS NOT NULL THEN true ELSE false END`
      : sql<boolean>`false`;

    let query = db
      .select({
        post: posts,
        user: users,
        tag: tags,
        isFavorited: isFavoritedExpr,
      })
      .from(posts)
      .leftJoin(users, eq(posts.userId, users.id))
      .leftJoin(postTags, eq(posts.id, postTags.postId))
      .leftJoin(tags, eq(postTags.tagId, tags.id));

    if (userId) {
      query = query.leftJoin(
        favorites,
        and(eq(favorites.postId, posts.id), eq(favorites.userId, userId))
      );
    }

    // @ts-ignore
    query = query.where(eq(posts.id, id));

    const results = await query;

    if (results.length === 0) return undefined;

    // @ts-ignore
    const postId = results[0].post.id;
    const postWithTags: PostWithTags = {
      // @ts-ignore
      ...results[0].post,
      // @ts-ignore
      user: results[0].user!,
      tags: [],
      // @ts-ignore
      isFavorited: results[0].isFavorited,
    };

    for (const row of results) {
      // @ts-ignore
      if (row.tag && !postWithTags.tags.some((t) => t.id === row.tag.id)) {
        postWithTags.tags.push(row.tag);
      }
    }

    return postWithTags;
  }

  async createPost(post: InsertPost, tagIds: string[]): Promise<Post> {
    const result = await db.transaction(async (tx) => {
      const [newPost] = await tx.insert(posts).values(post).returning();

      if (tagIds.length > 0) {
        await tx.insert(postTags).values(
          tagIds.map((tagId) => ({
            // @ts-ignore
            postId: newPost.id,
            tagId,
          }))
        );
      }

      return newPost;
    });

    // @ts-ignore
    return result;
  }

  async deletePost(id: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(posts)
      .where(and(eq(posts.id, id), eq(posts.userId, userId)))
      .returning();

    return result.length > 0;
  }

  async addFavorite(userId: string, postId: string): Promise<void> {
    await db.insert(favorites).values({ userId, postId }).onConflictDoNothing();
  }

  async removeFavorite(userId: string, postId: string): Promise<void> {
    await db
      .delete(favorites)
      .where(and(eq(favorites.userId, userId), eq(favorites.postId, postId)));
  }

  async getUserFavorites(
    userId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<PostWithTags[]> {
    const results = await db
      .select({
        post: posts,
        user: users,
        tag: tags,
        isFavorited: sql<boolean>`true`,
      })
      .from(favorites)
      .leftJoin(posts, eq(favorites.postId, posts.id))
      .leftJoin(users, eq(posts.userId, users.id))
      .leftJoin(postTags, eq(posts.id, postTags.postId))
      .leftJoin(tags, eq(postTags.tagId, tags.id))
      .where(eq(favorites.userId, userId))
      .orderBy(desc(favorites.createdAt))
      .limit(limit)
      .offset(offset);

    // Group results by post
    const postsMap = new Map<string, PostWithTags>();

    for (const result of results) {
      if (!result.post) continue;

      const postId = result.post.id;

      if (!postsMap.has(postId)) {
        postsMap.set(postId, {
          ...result.post,
          user: result.user!,
          tags: [],
          isFavorited: true,
        });
      }

      if (result.tag) {
        const existingPost = postsMap.get(postId)!;
        if (!existingPost.tags.some((t) => t.id === result.tag!.id)) {
          existingPost.tags.push(result.tag);
        }
      }
    }

    return Array.from(postsMap.values());
  }

  async addExcludeTag(userId: string, tagId: string): Promise<void> {
    await db
      .insert(userExcludeTags)
      .values({ userId, tagId })
      .onConflictDoNothing();
  }

  async removeExcludeTag(userId: string, tagId: string): Promise<void> {
    await db
      .delete(userExcludeTags)
      .where(
        and(
          eq(userExcludeTags.userId, userId),
          eq(userExcludeTags.tagId, tagId)
        )
      );
  }

  async getUserExcludeTags(userId: string): Promise<Tag[]> {
    const results = await db
      .select({ tag: tags })
      .from(userExcludeTags)
      .leftJoin(tags, eq(userExcludeTags.tagId, tags.id))
      .where(eq(userExcludeTags.userId, userId));

    return results.map((r) => r.tag!).filter(Boolean);
  }

  // replace user's exclude tags with given array (transactional)
  async setUserExcludeTags(userId: string, tagIds: string[]): Promise<void> {
    await db.transaction(async (tx) => {
      // delete existing
      await tx
        .delete(userExcludeTags)
        .where(eq(userExcludeTags.userId, userId));
      if (tagIds.length > 0) {
        await tx
          .insert(userExcludeTags)
          .values(tagIds.map((tagId) => ({ userId, tagId })))
          .onConflictDoNothing();
      }
    });
  }

  async validatePostTags(tagIds: string[]): Promise<boolean> {
    if (tagIds.length === 0) return false;

    const tagResults = await db
      .select()
      .from(tags)
      .where(inArray(tags.id, tagIds));

    // Check if all tag IDs exist
    if (tagResults.length !== tagIds.length) return false;

    // Check if at least one classification tag is present
    const hasClassificationTag = tagResults.some(
      (tag) => tag.category === "分類"
    );
    return hasClassificationTag;
  }
}

export const storage = new DatabaseStorage();
