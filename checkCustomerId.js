// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

p.$queryRawUnsafe("select column_name from information_schema.columns where table_name='Transaction' and column_name='customerId';")
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    return p.$disconnect();
  })
  .catch((e) => {
    console.error(e);
    return p.$disconnect().then(() => process.exit(1));
  });
