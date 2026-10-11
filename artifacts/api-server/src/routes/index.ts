import { Router, type IRouter } from "express";
import healthRouter from "./health";
import weatherRouter from "./weather";
import meRouter from "./me";
import checkInRouter from "./check-in";

const router: IRouter = Router();

router.use(healthRouter);
router.use(weatherRouter);
router.use(checkInRouter);
router.use(meRouter);

export default router;
