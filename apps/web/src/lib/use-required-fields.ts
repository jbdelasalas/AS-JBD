'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface FieldReq { form_key: string; field_key: string; label: string; required: boolean; }

/**
 * Reads the admin-configured required fields for a form (and optional line form)
 * and returns helpers to enforce them.
 *
 *   const { isRequired, validate, labels } = useRequiredFields('expense_report');
 *   const missing = validate(form);           // string[] of missing labels
 *   <label>Date {isRequired('report_date') && '*'}</label>
 */
export function useRequiredFields(formKey: string, lineFormKey?: string) {
  const [reqs, setReqs] = useState<FieldReq[]>([]);

  useEffect(() => {
    const cid = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;
    if (!cid) return;
    api.get<{ data: FieldReq[] }>(`/admin/field-requirements?company_id=${cid}`)
      .then((r) => setReqs(r.data ?? []))
      .catch(() => setReqs([]));
  }, []);

  const requiredFor = (fk: string) =>
    new Set(reqs.filter((r) => r.form_key === fk && r.required).map((r) => r.field_key));

  const headerRequired = requiredFor(formKey);
  const lineRequired = lineFormKey ? requiredFor(lineFormKey) : new Set<string>();

  const labelFor = (fk: string, field: string) =>
    reqs.find((r) => r.form_key === fk && r.field_key === field)?.label ?? field;

  return {
    /** Is this header field required? */
    isRequired: (field: string) => headerRequired.has(field),
    /** Is this line field required? */
    isLineRequired: (field: string) => lineRequired.has(field),
    /** Validate a header object → array of missing field labels. */
    validate: (values: Record<string, unknown>): string[] => {
      const missing: string[] = [];
      for (const field of headerRequired) {
        const v = values[field];
        if (v == null || v === '' || (typeof v === 'number' && isNaN(v))) missing.push(labelFor(formKey, field));
      }
      return missing;
    },
    /** Validate one line object → array of missing field labels (prefixed with line no). */
    validateLine: (line: Record<string, unknown>, lineNo: number): string[] => {
      const missing: string[] = [];
      for (const field of lineRequired) {
        const v = line[field];
        const empty = v == null || v === '' || (field === 'amount' && Number(v) <= 0);
        if (empty) missing.push(`Line ${lineNo}: ${labelFor(lineFormKey!, field)}`);
      }
      return missing;
    },
  };
}
