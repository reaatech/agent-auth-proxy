DO $$ BEGIN
 ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_provider_unique" UNIQUE ("user_id", "provider");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
