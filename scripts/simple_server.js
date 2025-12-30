import express from 'express';
const app = express();
const PORT = process.env.PORT || 5555;
app.get('/', (req, res) => res.send('ok'));
app.listen(PORT, ()=>console.log('simple server listening', PORT));
