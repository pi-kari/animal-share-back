// src/auth.ts
import type { Express, RequestHandler } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { storage } from "./storage";
import type { UpsertUser } from "./schema"; // schema に定義済みの型
import { pool } from "./db";

const PgSession = connectPgSimple(session);

export async function setupAuth(app: Express) {
  // Session middleware (store in Postgres table 'sessions' to match your schema)

  // 環境変数の検証
  if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is required");
  }

  app.use(
    session({
      store: new PgSession({
        pool: pool,
        tableName: "sessions", // 既存スキーマに合わせる
      }) as any,
      secret: process.env.SESSION_SECRET ?? "",
      resave: false,
      saveUninitialized: false,
      cookie: {
        // 必要に応じて調整
        maxAge: 14 * 24 * 60 * 60 * 1000, // 14 days
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      },
    })
  );

  // Passport init
  app.use(passport.initialize());
  app.use(passport.session());

  // serializeUser: session に user.id を保存
  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  // deserializeUser: session から id を読み、storage から user を取得して req.user に置く
  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user ?? null);
    } catch (err) {
      done(err as Error);
    }
  });

  // Google OAuth Strategy
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID ?? "",
        clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        callbackURL: `${process.env.BACKEND_URL?.replace(
          /\/$/,
          ""
        )}/api/auth/google/callback`,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value ?? "";
          const upsert: UpsertUser = {
            email,
            firstName: profile.name?.givenName ?? "",
            lastName: profile.name?.familyName ?? "",
            profileImageUrl: profile.photos?.[0]?.value ?? "",
          };
          // storage.upsertUser は存在しなければ作成、あれば更新して user オブジェクトを返す想定
          const user = await storage.upsertUser(upsert);
          done(null, user);
        } catch (err) {
          done(err as Error | null, undefined);
        }
      }
    )
  );

  // --- Auth routes used by frontend ---
  // 認証開始
  app.get(
    "/api/auth/google",
    passport.authenticate("google", {
      scope: ["profile", "email"],
      prompt: "select_account",
    })
  );

  // Google callback
  app.get(
    "/api/auth/google/callback",
    passport.authenticate("google", {
      failureRedirect: `${
        process.env.FRONTEND_URL ?? "/login"
      }?error=google_auth`,
    }),
    (req, res) => {
      // 成功時：req.user が存在するはず -> フロントへリダイレクト
      res.redirect(process.env.FRONTEND_URL ?? "/");
    }
  );

  // ログアウト
  app.post("/api/auth/logout", (req: any, res) => {
    req.logout((err: any) => {
      // ignore err
      req.session?.destroy(() => {
        res.json({ success: true });
      });
    });
  });

  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
}

// isAuthenticated ミドルウェアをエクスポート
export const isAuthenticated: RequestHandler = (req: any, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    // 既存コードが req.user.claims.sub を期待しているため保証しておく
    if (!req.user.claims) req.user.claims = { sub: req.user.id };
    else if (!req.user.claims.sub) req.user.claims.sub = req.user.id;
    return next();
  }
  res.status(401).json({ message: "Unauthorized" });
};
