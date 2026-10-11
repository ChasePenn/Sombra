import { Router, type IRouter } from "express";
import healthRouter from "./health";
import weatherRouter from "./weather";
import meRouter from "./me";
import checkInRouter from "./check-in";
import conditionsRouter from "./conditions";
import pushRouter from "./push";

const router: IRouter = Router();

router.use(healthRouter);
router.use(weatherRouter);
router.use(conditionsRouter);
router.use(pushRouter);
router.use(checkInRouter);
router.use(meRouter);

export default router;
