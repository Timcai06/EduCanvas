-- Cross-table validity cannot be expressed by a CHECK constraint. Locking the
-- consent row serializes retention creation with revocation so the two writes
-- cannot both commit from stale consent state.
CREATE FUNCTION enforce_audio_retention_valid_consent() RETURNS trigger AS $$
DECLARE
	consent_status text;
	consent_expires_at timestamp with time zone;
BEGIN
	SELECT status, expires_at
	INTO consent_status, consent_expires_at
	FROM audio_consents
	WHERE id = NEW.consent_id
	FOR UPDATE;

	IF consent_status IS NULL
		OR consent_status <> 'active'
		OR consent_expires_at <= NEW.created_at THEN
		RAISE EXCEPTION 'audio retention requires active consent valid at creation'
			USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audio_retentions_consent_valid
BEFORE INSERT ON audio_retentions
FOR EACH ROW EXECUTE FUNCTION enforce_audio_retention_valid_consent();
--> statement-breakpoint

-- Consent identity, authority and expiry are an append-only audit fact. Only
-- the explicit active -> revoked lifecycle transition may mutate the row.
CREATE FUNCTION enforce_audio_consent_immutability() RETURNS trigger AS $$
BEGIN
	IF OLD.id IS DISTINCT FROM NEW.id
		OR OLD.subject_user_id IS DISTINCT FROM NEW.subject_user_id
		OR OLD.grantor_user_id IS DISTINCT FROM NEW.grantor_user_id
		OR OLD.authorization_type IS DISTINCT FROM NEW.authorization_type
		OR OLD.proof_method IS DISTINCT FROM NEW.proof_method
		OR OLD.proof_reference IS DISTINCT FROM NEW.proof_reference
		OR OLD.purpose IS DISTINCT FROM NEW.purpose
		OR OLD.consent_version IS DISTINCT FROM NEW.consent_version
		OR OLD.notice_version IS DISTINCT FROM NEW.notice_version
		OR OLD.granted_at IS DISTINCT FROM NEW.granted_at
		OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
		OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
		RAISE EXCEPTION 'audio consent immutable identity fields cannot change'
			USING ERRCODE = '23514';
	END IF;

	IF OLD.status = 'revoked'
		OR (OLD.status <> NEW.status AND NOT (OLD.status = 'active' AND NEW.status = 'revoked')) THEN
		IF OLD.status IS DISTINCT FROM NEW.status
			OR OLD.revoked_at IS DISTINCT FROM NEW.revoked_at THEN
			RAISE EXCEPTION 'audio consent terminal lifecycle cannot change'
				USING ERRCODE = '23514';
		END IF;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audio_consents_immutable
BEFORE UPDATE ON audio_consents
FOR EACH ROW EXECUTE FUNCTION enforce_audio_consent_immutability();
--> statement-breakpoint

CREATE FUNCTION prevent_audio_consent_delete() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'audio consent is an immutable audit fact'
		USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audio_consents_no_delete
BEFORE DELETE ON audio_consents
FOR EACH ROW EXECUTE FUNCTION prevent_audio_consent_delete();
--> statement-breakpoint

-- Retention identity and deadline cannot be rewritten after object creation.
-- V14 may only move active -> deletion_requested while atomically enqueueing
-- the physical object deletion in the existing outbox.
CREATE FUNCTION enforce_audio_retention_immutability() RETURNS trigger AS $$
BEGIN
	IF OLD.id IS DISTINCT FROM NEW.id
		OR OLD.subject_user_id IS DISTINCT FROM NEW.subject_user_id
		OR OLD.consent_id IS DISTINCT FROM NEW.consent_id
		OR OLD.consent_purpose IS DISTINCT FROM NEW.consent_purpose
		OR OLD.asset_version_id IS DISTINCT FROM NEW.asset_version_id
		OR OLD.created_at IS DISTINCT FROM NEW.created_at
		OR OLD.expires_at IS DISTINCT FROM NEW.expires_at THEN
		RAISE EXCEPTION 'audio retention immutable identity fields cannot change'
			USING ERRCODE = '23514';
	END IF;

	IF OLD.status = 'deletion_requested'
		OR (OLD.status <> NEW.status AND NOT (OLD.status = 'active' AND NEW.status = 'deletion_requested')) THEN
		IF OLD.status IS DISTINCT FROM NEW.status
			OR OLD.deletion_requested_at IS DISTINCT FROM NEW.deletion_requested_at THEN
			RAISE EXCEPTION 'audio retention terminal lifecycle cannot change'
				USING ERRCODE = '23514';
		END IF;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audio_retentions_immutable
BEFORE UPDATE ON audio_retentions
FOR EACH ROW EXECUTE FUNCTION enforce_audio_retention_immutability();
--> statement-breakpoint

CREATE FUNCTION prevent_audio_retention_delete() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'audio retention is an immutable audit fact'
		USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audio_retentions_no_delete
BEFORE DELETE ON audio_retentions
FOR EACH ROW EXECUTE FUNCTION prevent_audio_retention_delete();
