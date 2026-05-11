import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";

/**
 * Inventory module — STUB.
 *
 * TODO: implement endpoints. See README in this folder for the next steps.
 */
@ApiTags("inventory")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("inventory")
export class InventoryController {
  @Get("_status")
  status() {
    return { module: "inventory", status: "stub" };
  }
}
