'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export interface TagRef { id: string; code: string; name: string; }

export interface TaggingData {
  branches: TagRef[];
  buildings: TagRef[];
  costCenters: TagRef[];
  growRefs: TagRef[];
}

export function useTaggingData(): TaggingData {
  const [branches, setBranches] = useState<TagRef[]>([]);
  const [buildings, setBuildings] = useState<TagRef[]>([]);
  const [costCenters, setCostCenters] = useState<TagRef[]>([]);
  const [growRefs, setGrowRefs] = useState<TagRef[]>([]);

  useEffect(() => {
    const cid = localStorage.getItem('company_id');
    if (!cid) return;
    api.get<{ data: TagRef[] }>(`/admin/branches?company_id=${cid}&limit=100`).then(r => setBranches(r.data ?? [])).catch(() => {});
    api.get<{ data: TagRef[] }>(`/poultry/buildings?company_id=${cid}&limit=100`).then(r => setBuildings(r.data ?? [])).catch(() => {});
    api.get<{ data: TagRef[] }>(`/admin/cost-centers?company_id=${cid}&limit=100`).then(r => setCostCenters(r.data ?? [])).catch(() => {});
    api.get<{ data: TagRef[] }>(`/poultry/grow-references?company_id=${cid}&limit=100`).then(r => setGrowRefs(r.data ?? [])).catch(() => {});
  }, []);

  return { branches, buildings, costCenters, growRefs };
}
