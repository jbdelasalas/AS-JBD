import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { TrialBalanceRow } from '@perpet/shared';

@Injectable()
export class TrialBalanceService {
  constructor(private readonly ds: DataSource) {}

  /**
   * Trial balance as of a given date — sums all posted entries up to and including the date.
   */
  async asOf(companyId: string, asOfDate: string): Promise<TrialBalanceRow[]> {
    return this.ds.query(
      `SELECT a.code  AS account_code,
              a.name  AS account_name,
              a.account_type,
              COALESCE(SUM(jel.debit ),  0)::float AS debit,
              COALESCE(SUM(jel.credit), 0)::float AS credit
         FROM accounts a
         LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
         LEFT JOIN journal_entries je ON je.id = jel.entry_id AND je.status = 'posted'
                                       AND je.entry_date <= $2::date
        WHERE a.company_id = $1
        GROUP BY a.id, a.code, a.name, a.account_type
        HAVING COALESCE(SUM(jel.debit), 0) <> 0 OR COALESCE(SUM(jel.credit), 0) <> 0
        ORDER BY a.code`,
      [companyId, asOfDate],
    );
  }
}
