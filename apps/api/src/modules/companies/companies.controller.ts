import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";

/**
 * Companies module — STUB.
 *
 * TODO: implement endpoints. See README in this folder for the next steps.
 */
@ApiTags("companies")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("companies")
export class CompaniesController {
  @Get("_status")
  status() {
    return { module: "companies", status: "stub" };
  }
}
