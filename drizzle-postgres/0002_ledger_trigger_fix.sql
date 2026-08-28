CREATE OR REPLACE FUNCTION cimbra_validate_journal_balance() RETURNS trigger AS $$
DECLARE
  target_journal_id text;
  debit_total numeric;
  credit_total numeric;
  posting_count integer;
  invalid_postings integer;
BEGIN
  IF TG_TABLE_NAME = 'ledger_journals' THEN
    target_journal_id := NEW.id;
  ELSE
    target_journal_id := NEW.journal_id;
  END IF;
  SELECT
    COALESCE(SUM(CASE WHEN p.direction = 'debit' THEN p.amount_minor ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN p.direction = 'credit' THEN p.amount_minor ELSE 0 END), 0),
    COUNT(*),
    COUNT(*) FILTER (WHERE p.organization_id <> j.organization_id OR p.currency <> j.currency OR a.organization_id <> j.organization_id OR a.currency <> j.currency)
  INTO debit_total, credit_total, posting_count, invalid_postings
  FROM ledger_journals j
  LEFT JOIN ledger_postings p ON p.journal_id = j.id
  LEFT JOIN financial_accounts a ON a.id = p.account_id
  WHERE j.id = target_journal_id
  GROUP BY j.id;
  IF posting_count < 2 OR debit_total <> credit_total OR debit_total <= 0 OR invalid_postings > 0 THEN
    RAISE EXCEPTION 'ledger journal % is unbalanced or crosses tenant/currency boundaries', target_journal_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
