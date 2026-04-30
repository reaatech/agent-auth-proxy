DO $$ BEGIN
 ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_user_id_provider_unique" UNIQUE ("user_id", "provider");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
