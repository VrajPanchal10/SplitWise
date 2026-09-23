import React, { createContext, useContext, useState, ReactNode } from 'react';

export interface BillItem {
  id: string;
  name: string;
  price: number;
  selected: boolean;
  sharedByUserIds: string[];
  customShares?: { [userId: string]: number };
}

interface BillCreationContextType {
  groupId: string;
  setGroupId: (groupId: string) => void;
  scannedItems: BillItem[];
  setScannedItems: (items: BillItem[]) => void;
  resetBill: () => void;
}

const BillCreationContext = createContext<BillCreationContextType | undefined>(undefined);

export const BillCreationProvider = ({ children }: { children: ReactNode }) => {
  const [groupId, setGroupId] = useState('');
  const [scannedItems, setScannedItems] = useState<BillItem[]>([]);

  const resetBill = () => {
    setGroupId('');
    setScannedItems([]);
  };

  return (
    <BillCreationContext.Provider
    value={{
        groupId,
        setGroupId,
        scannedItems,
        setScannedItems,
        resetBill,
      }}>
      {children}
    </BillCreationContext.Provider>
  );
};

export const useBillCreation = () => {
  const context = useContext(BillCreationContext);
  if (context === undefined) {
    throw new Error('useBillCreation must be used within a BillCreationProvider');
  }
  return context;
};