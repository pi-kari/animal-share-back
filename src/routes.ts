import type { Express, RequestHandler } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertPostSchema, insertTagSchema, Tag } from "./schema";
import { z } from "zod";
import { setupAuth, isAuthenticated } from "./auth";

const createPostWithTagsSchema = insertPostSchema
  .omit({ userId: true })
  .extend({
    tagIds: z.array(z.string()).min(1, "At least one tag is required"),
  });

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // Initialize default tags
  await initializeDefaultTags();

  // Tags routes
  app.get("/api/tags", async (req, res) => {
    try {
      const { category } = req.query;
      let tags;

      if (category && typeof category === "string") {
        tags = await storage.getTagsByCategory(category as any);
      } else {
        tags = await storage.getAllTags();
      }

      res.json(tags);
    } catch (error) {
      console.error("Error fetching tags:", error);
      res.status(500).json({ message: "Failed to fetch tags" });
    }
  });

  app.post("/api/tags", isAuthenticated, async (req, res) => {
    try {
      const tagData = insertTagSchema.parse(req.body);
      const tag = await storage.createTag(tagData);
      res.json(tag);
    } catch (error) {
      console.error("Error creating tag:", error);
      res.status(400).json({ message: "Invalid tag data" });
    }
  });

  // Posts routes
  app.get("/api/posts", async (req: any, res) => {
    try {
      const { limit = 20, offset = 0, tagIds } = req.query;

      const userId = req.user?.claims?.sub;
      const parsedTagIds = tagIds
        ? Array.isArray(tagIds)
          ? tagIds
          : [tagIds]
        : undefined;

      const posts = await storage.getPosts(
        parseInt(limit),
        parseInt(offset),
        parsedTagIds,
        userId
      );

      res.json(posts);
    } catch (error) {
      console.error("Error fetching posts:", error);
      res.status(500).json({ message: "Failed to fetch posts" });
    }
  });

  app.get("/api/posts/:id", async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user?.claims?.sub;

      const post = await storage.getPost(id, userId);

      if (!post) {
        return res.status(404).json({ message: "Post not found" });
      }

      res.json(post);
    } catch (error) {
      console.error("Error fetching post:", error);
      res.status(500).json({ message: "Failed to fetch post" });
    }
  });

  app.post("/api/posts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { tagIds, ...postData } = createPostWithTagsSchema.parse(req.body);

      // Validate that tags include required classification tag
      const isValid = await storage.validatePostTags(tagIds);
      if (!isValid) {
        return res.status(400).json({
          message:
            "Invalid tags. At least one classification tag (分類) is required.",
        });
      }

      const post = await storage.createPost({ ...postData, userId }, tagIds);

      res.json(post);
    } catch (error) {
      console.error("Error creating post:", error);
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid post data", errors: error });
      }
      res.status(500).json({ message: "Failed to create post" });
    }
  });

  app.delete("/api/posts/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.claims.sub;

      const success = await storage.deletePost(id, userId);

      if (!success) {
        return res
          .status(404)
          .json({ message: "Post not found or unauthorized" });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting post:", error);
      res.status(500).json({ message: "Failed to delete post" });
    }
  });

  // Favorites routes
  app.post("/api/favorites", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { postId } = req.body;

      if (!postId) {
        return res.status(400).json({ message: "postId is required" });
      }

      await storage.addFavorite(userId, postId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error adding favorite:", error);
      res.status(500).json({ message: "Failed to add favorite" });
    }
  });

  app.delete(
    "/api/favorites/:postId",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = req.user.claims.sub;
        const { postId } = req.params;

        await storage.removeFavorite(userId, postId);
        res.json({ success: true });
      } catch (error) {
        console.error("Error removing favorite:", error);
        res.status(500).json({ message: "Failed to remove favorite" });
      }
    }
  );

  app.get("/api/user/favorites", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { limit = 20, offset = 0 } = req.query;

      const favorites = await storage.getUserFavorites(
        userId,
        parseInt(limit),
        parseInt(offset)
      );

      res.json(favorites);
    } catch (error) {
      console.error("Error fetching user favorites:", error);
      res.status(500).json({ message: "Failed to fetch favorites" });
    }
  });

  // User posts route
  app.get("/api/user/posts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { limit = 20, offset = 0 } = req.query;

      const posts = await storage.getPosts(
        parseInt(limit),
        parseInt(offset),
        undefined,
        userId
      );

      // Filter to only user's posts
      const userPosts = posts.filter((post) => post.userId === userId);

      res.json(userPosts);
    } catch (error) {
      console.error("Error fetching user posts:", error);
      res.status(500).json({ message: "Failed to fetch user posts" });
    }
  });

  // Exclude tags routes (zoning feature)
  app.get("/api/exclude-tags", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const excludeTags = await storage.getUserExcludeTags(userId);
      res.json(excludeTags);
    } catch (error) {
      console.error("Error fetching exclude tags:", error);
      res.status(500).json({ message: "Failed to fetch exclude tags" });
    }
  });

  // 修正前の箇所を置き換える
  app.post("/api/exclude-tags", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { tagIds } = req.body as { tagIds: string[] };

      if (!Array.isArray(tagIds) || tagIds.length === 0) {
        return res.status(400).json({ message: "tagIds is required" });
      }

      for (const tagId of tagIds) {
        if (typeof tagId !== "string" || tagId.trim() === "") continue;
        await storage.addExcludeTag(userId, tagId);
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error adding exclude tags:", error);
      res.status(500).json({ message: "Failed to add exclude tags" });
    }
  });

  app.delete(
    "/api/exclude-tags/:tagId",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = req.user.claims.sub;
        const { tagId } = req.params;

        await storage.removeExcludeTag(userId, tagId);
        res.json({ success: true });
      } catch (error) {
        console.error("Error removing exclude tag:", error);
        res.status(500).json({ message: "Failed to remove exclude tag" });
      }
    }
  );

  const httpServer = createServer(app);
  return httpServer;
}

async function initializeDefaultTags() {
  try {
    // Initialize default tags from the specification
    const defaultTags = [
      // 分類 tags
      { name: "犬", category: "分類" as const },
      { name: "猫", category: "分類" as const },
      { name: "鳥類", category: "分類" as const },
      { name: "爬虫類", category: "分類" as const },
      { name: "両生類", category: "分類" as const },
      { name: "魚類", category: "分類" as const },
      { name: "小動物", category: "分類" as const },
      { name: "昆虫", category: "分類" as const },
      { name: "その他", category: "分類" as const },

      // 角度 tags
      { name: "正面", category: "角度" as const },
      { name: "横", category: "角度" as const },
      { name: "斜め", category: "角度" as const },
      { name: "上", category: "角度" as const },
      { name: "下", category: "角度" as const },
      { name: "後ろ", category: "角度" as const },

      // パーツ tags
      { name: "耳", category: "パーツ" as const },
      { name: "ヒゲ", category: "パーツ" as const },
      { name: "ツノ", category: "パーツ" as const },
      { name: "牙", category: "パーツ" as const },
      { name: "目", category: "パーツ" as const },
      { name: "鼻", category: "パーツ" as const },
      { name: "しっぽ", category: "パーツ" as const },
    ];

    for (const tag of defaultTags) {
      await storage.getOrCreateTag(tag.name, tag.category);
    }
  } catch (error) {
    console.error("Error initializing default tags:", error);
  }
}
