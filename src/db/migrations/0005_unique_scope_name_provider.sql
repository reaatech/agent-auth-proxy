DO $$ BEGIN
 ALTER TABLE "scopes" ADD CONSTRAINT "scopes_name_provider_unique" UNIQUE ("name", "provider");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
