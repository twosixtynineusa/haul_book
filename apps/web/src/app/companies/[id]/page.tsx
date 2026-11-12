import { CompanyPage } from '@/components/company-page';

export default async function Company({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CompanyPage key={id} id={id} />;
}
