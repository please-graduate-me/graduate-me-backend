import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { databaseOptions } from './options.js';

/** CLI가 Nest 서버를 띄우지 않고 같은 DB 설정을 사용하게 한다. */
export default new DataSource(databaseOptions());
