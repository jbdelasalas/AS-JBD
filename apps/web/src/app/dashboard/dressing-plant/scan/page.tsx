'use client';

import ScanMoveWorkbench from '@/components/ScanMoveWorkbench';

// Same workbench as Warehouse — the plant moves the very same boxes and pallets
// into the very same bins, so it shares the component rather than forking it.
export default function DressingPlantScanPage() {
  return (
    <ScanMoveWorkbench subtitle="Scan a box or pallet coming off the line, then scan the chiller or storage bin it goes into." />
  );
}
