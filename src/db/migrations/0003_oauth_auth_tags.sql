ALTER TABLE "oauth_tokens" ADD COLUMN "access_token_auth_tag" text;
--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD COLUMN "refresh_token_auth_tag" text;
--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD COLUMN "id_token_auth_tag" text;
