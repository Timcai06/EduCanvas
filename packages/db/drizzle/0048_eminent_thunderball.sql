CREATE TABLE "audio_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_user_id" text NOT NULL,
	"grantor_user_id" text NOT NULL,
	"authorization_type" text NOT NULL,
	"proof_method" text NOT NULL,
	"proof_reference" text NOT NULL,
	"purpose" text NOT NULL,
	"consent_version" text NOT NULL,
	"notice_version" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '12 months' NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audio_consents_id_purpose_subject_unique" UNIQUE("id","purpose","subject_user_id"),
	CONSTRAINT "audio_consents_authorization_check" CHECK ("audio_consents"."authorization_type" in ('self', 'guardian')
        and (("audio_consents"."authorization_type" = 'self'
              and "audio_consents"."grantor_user_id" = "audio_consents"."subject_user_id"
              and "audio_consents"."proof_method" in ('adult_self_attested', 'adult_verified'))
          or ("audio_consents"."authorization_type" = 'guardian'
              and "audio_consents"."grantor_user_id" <> "audio_consents"."subject_user_id"
              and "audio_consents"."proof_method" in ('guardian_self_attested', 'guardian_verified')))),
	CONSTRAINT "audio_consents_purpose_check" CHECK ("audio_consents"."purpose" in ('voice_processing', 'audio_retention', 'cloud_transcription')),
	CONSTRAINT "audio_consents_status_check" CHECK ("audio_consents"."status" in ('active', 'revoked')),
	CONSTRAINT "audio_consents_lifecycle_check" CHECK (("audio_consents"."status" = 'active' and "audio_consents"."revoked_at" is null)
        or ("audio_consents"."status" = 'revoked' and "audio_consents"."revoked_at" is not null)),
	CONSTRAINT "audio_consents_time_check" CHECK ("audio_consents"."expires_at" > "audio_consents"."granted_at"
        and "audio_consents"."expires_at" <= "audio_consents"."granted_at" + interval '12 months'
        and ("audio_consents"."revoked_at" is null or "audio_consents"."revoked_at" >= "audio_consents"."granted_at")),
	CONSTRAINT "audio_consents_version_check" CHECK (char_length("audio_consents"."consent_version") between 1 and 64
        and char_length("audio_consents"."notice_version") between 1 and 64
        and char_length("audio_consents"."proof_reference") between 1 and 256)
);
--> statement-breakpoint
CREATE TABLE "audio_retentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_user_id" text NOT NULL,
	"consent_id" uuid NOT NULL,
	"consent_purpose" text NOT NULL,
	"asset_version_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"deletion_requested_at" timestamp with time zone,
	CONSTRAINT "audio_retentions_purpose_check" CHECK ("audio_retentions"."consent_purpose" = 'audio_retention'),
	CONSTRAINT "audio_retentions_status_check" CHECK ("audio_retentions"."status" in ('active', 'deletion_requested')),
	CONSTRAINT "audio_retentions_time_check" CHECK ("audio_retentions"."expires_at" >= "audio_retentions"."created_at"
        and "audio_retentions"."expires_at" <= "audio_retentions"."created_at" + interval '7 days'),
	CONSTRAINT "audio_retentions_lifecycle_check" CHECK (("audio_retentions"."status" = 'active' and "audio_retentions"."deletion_requested_at" is null)
        or ("audio_retentions"."status" = 'deletion_requested' and "audio_retentions"."deletion_requested_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "audio_consents" ADD CONSTRAINT "audio_consents_subject_user_id_platform_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."platform_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_consents" ADD CONSTRAINT "audio_consents_grantor_user_id_platform_users_id_fk" FOREIGN KEY ("grantor_user_id") REFERENCES "public"."platform_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_retentions" ADD CONSTRAINT "audio_retentions_subject_user_id_platform_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."platform_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_retentions" ADD CONSTRAINT "audio_retentions_asset_version_id_asset_versions_id_fk" FOREIGN KEY ("asset_version_id") REFERENCES "public"."asset_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_retentions" ADD CONSTRAINT "audio_retentions_consent_purpose_subject_fk" FOREIGN KEY ("consent_id","consent_purpose","subject_user_id") REFERENCES "public"."audio_consents"("id","purpose","subject_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audio_consents_subject_purpose_active_unique" ON "audio_consents" USING btree ("subject_user_id","purpose") WHERE "audio_consents"."status" = 'active';--> statement-breakpoint
CREATE INDEX "audio_consents_subject_status_idx" ON "audio_consents" USING btree ("subject_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "audio_retentions_asset_version_unique" ON "audio_retentions" USING btree ("asset_version_id");--> statement-breakpoint
CREATE INDEX "audio_retentions_subject_status_idx" ON "audio_retentions" USING btree ("subject_user_id","status");--> statement-breakpoint
CREATE INDEX "audio_retentions_consent_fk_idx" ON "audio_retentions" USING btree ("consent_id");--> statement-breakpoint
CREATE INDEX "audio_retentions_expiry_idx" ON "audio_retentions" USING btree ("status","expires_at");