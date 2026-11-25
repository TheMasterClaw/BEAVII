import { CreateETFForm } from '@/components/etf/create-etf-form';

export default function CreateEtfPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Launch your own ITF</h2>
        <p className="mt-1 max-w-2xl text-muted-foreground">
          Build a basket of tokenized stocks, set your fees, and earn a share of the ITF for running it. Anyone can invest; you
          manage the weights and rebalancing.
        </p>
      </div>
      <CreateETFForm />
    </div>
  );
}
