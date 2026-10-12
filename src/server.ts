import { buildApp } from './app.ts';

const app = buildApp({ logger: true });
const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: '127.0.0.1' }).then((address) => {
  console.log(`ouvindo em ${address}`);
});
