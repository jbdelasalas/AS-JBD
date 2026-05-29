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
    api.get<TagRef[]>(`/admin/branches?company_id=${cid}&limit=100`).then(r => setBranches(Array.isArray(r) ? r : [])).catch(() => {});
    api.get<TagRef[]>(`/poultry/buildings?company_id=${cid}&limit=100`).then(r => setBuildings(Array.isArray(r) ? r : [])).catch(() => {});
    api.get<TagRef[]>(`/admin/cost-centers?company_id=${cid}&limit=100`).then(r => setCostCenters(Array.isArray(r) ? r : [])).catch(() => {});
    api.get<TagRef[]>(`/poultry/grow-references?company_id=${cid}&limit=100`).then(r => setGrowRefs(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);

  return { branches, buildings, costCenters, growRefs };
}
