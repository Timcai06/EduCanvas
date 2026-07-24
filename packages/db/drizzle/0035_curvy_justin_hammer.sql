CREATE TABLE "web_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "web_sessions_token_hash_check" CHECK ("web_sessions"."token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "web_sessions_lifecycle_check" CHECK ("web_sessions"."expires_at" > "web_sessions"."created_at" and ("web_sessions"."revoked_at" is null or "web_sessions"."revoked_at" >= "web_sessions"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "web_user_credentials" (
	"user_id" text PRIMARY KEY NOT NULL,
	"username_normalized" text NOT NULL,
	"password_hash" text NOT NULL,
	"password_salt" text NOT NULL,
	"password_params" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "web_user_credentials_username_check" CHECK ("web_user_credentials"."username_normalized" ~ '^[a-z0-9][a-z0-9_-]{2,31}$'),
	CONSTRAINT "web_user_credentials_password_material_check" CHECK ("web_user_credentials"."password_hash" ~ '^[A-Za-z0-9_-]{43,128}$' and "web_user_credentials"."password_salt" ~ '^[A-Za-z0-9_-]{16,128}$' and jsonb_typeof("web_user_credentials"."password_params") = 'object')
);
--> statement-breakpoint
CREATE TABLE "web_user_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"nickname" text NOT NULL,
	"avatar_object_key" text,
	"avatar_mime_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "web_user_profiles_nickname_check" CHECK (char_length("web_user_profiles"."nickname") between 1 and 30 and "web_user_profiles"."nickname" !~ '[[:cntrl:]]'),
	CONSTRAINT "web_user_profiles_avatar_check" CHECK (("web_user_profiles"."avatar_object_key" is null and "web_user_profiles"."avatar_mime_type" is null) or ("web_user_profiles"."avatar_object_key" ~ '^assets/[a-f0-9]{16}/[0-9a-f-]+\.[a-z0-9]+$' and "web_user_profiles"."avatar_mime_type" in ('image/png', 'image/jpeg', 'image/webp')))
);
--> statement-breakpoint
ALTER TABLE "web_sessions" ADD CONSTRAINT "web_sessions_user_id_platform_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_user_credentials" ADD CONSTRAINT "web_user_credentials_user_id_platform_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_user_profiles" ADD CONSTRAINT "web_user_profiles_user_id_platform_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "web_sessions_token_hash_unique" ON "web_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "web_sessions_user_active_idx" ON "web_sessions" USING btree ("user_id","expires_at","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "web_user_credentials_username_unique" ON "web_user_credentials" USING btree ("username_normalized");