import { TruckPage } from '@/components/truck-page';

export default async function Truck({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TruckPage id={id} />;
}
