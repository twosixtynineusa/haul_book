import { CompaniesPage } from '@/components/companies-page';
import { redirect } from 'next/navigation';

export default async function Companies({
  searchParams,
}: {
  searchParams: Promise<{ company?: string | string[] }>;
}) {
  const { company } = await searchParams;
  if (typeof company === 'string' && company) redirect(`/companies/${encodeURIComponent(company)}`);
  return <CompaniesPage />;
}
